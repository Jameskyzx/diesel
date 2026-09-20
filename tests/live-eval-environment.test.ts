import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("live-eval environment initialization", () => {
  it.each([
    {
      label: "conflicting inherited settings",
      inherited: {
        AI_CHAT_RATE_LIMIT_BACKEND: "postgres",
        AI_INCLUDE_USAGE: "false",
        DATABASE_MODE: "postgres",
        PORTFOLIO_DEMO_MODE: "true",
      },
    },
    { label: "absent optional settings", inherited: {} },
  ] as const)(
    "applies live-eval settings before real ESM imports with $label",
    async ({ inherited }) => {
      const workspace = process.cwd();
      const temporaryWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-environment-"),
      );
      const moduleUrls = Object.fromEntries(
        [
          ["runner", "scripts/ai/live-eval.ts"],
          ["environment", "src/env.ts"],
          ["databaseEnvironment", "src/server/db/environment.ts"],
          ["model", "src/server/ai/model.ts"],
        ].map(([name, path]) => [
          name,
          pathToFileURL(resolve(workspace, path)).href,
        ]),
      );

      try {
        // A fresh native ESM process preserves application import ordering;
        // Vitest's module mocks would conceal an eagerly cached @/env value.
        // Its empty cwd also keeps any unexpected report write away from the
        // repository, and no real credentials or .env.local are inherited.
        const execution = spawnSync(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            pathToFileURL(require.resolve("tsx")).href,
            "--input-type=module",
            "--eval",
            [
              "const urls = JSON.parse(process.argv[1]);",
              "let fetchCalls = 0;",
              "globalThis.fetch = () => {",
              "  fetchCalls += 1;",
              '  throw new Error("Network calls are forbidden in this import test.");',
              "};",
              "const runner = await import(urls.runner);",
              "const { env } = await import(urls.environment);",
              "const { getDatabaseMode } = await import(urls.databaseEnvironment);",
              "const { getConfiguredAiModel } = await import(urls.model);",
              "const { providerProfile } = getConfiguredAiModel();",
              "process.stdout.write(JSON.stringify({",
              "  raw: {",
              "    backend: process.env.AI_CHAT_RATE_LIMIT_BACKEND,",
              "    database: process.env.DATABASE_MODE,",
              "    includeUsage: process.env.AI_INCLUDE_USAGE,",
              "    portfolioDemo: process.env.PORTFOLIO_DEMO_MODE,",
              "  },",
              "  parsed: {",
              "    backend: env.AI_CHAT_RATE_LIMIT_BACKEND,",
              "    database: getDatabaseMode(),",
              "    includeUsage: env.AI_INCLUDE_USAGE,",
              "    portfolioDemo: env.PORTFOLIO_DEMO_MODE,",
              "  },",
              "  adapter: providerProfile.adapter,",
              "  providerIncludesUsage: providerProfile.includeUsage,",
              '  runnerAvailable: typeof runner.runLiveEval === "function",',
              '  databaseInitialized: Reflect.has(globalThis, "__demoDatabaseConnection"),',
              "  fetchCalls,",
              "}));",
            ].join("\n"),
            JSON.stringify(moduleUrls),
          ],
          {
            cwd: temporaryWorkspace,
            encoding: "utf8",
            env: {
              AI_API_KEY: "synthetic-live-eval-import-test-key",
              AI_BASE_URL: "https://example.invalid/v1",
              AI_ENABLE_THINKING: "false",
              AI_MODEL: "synthetic-live-eval-import-test-model",
              AI_PROVIDER: "openai-compatible",
              NODE_ENV: "development",
              TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
              ...inherited,
            },
            timeout: 15_000,
          },
        );

        expect(execution.error).toBeUndefined();
        expect(execution.status, execution.stderr).toBe(0);
        expect(execution.stderr).toBe("");
        expect(JSON.parse(execution.stdout) as unknown).toEqual({
          raw: {
            backend: "memory",
            database: "pglite-demo",
            includeUsage: "true",
            portfolioDemo: "false",
          },
          parsed: {
            backend: "memory",
            database: "pglite-demo",
            includeUsage: true,
            portfolioDemo: false,
          },
          adapter: "@ai-sdk/openai-compatible",
          providerIncludesUsage: true,
          runnerAvailable: true,
          databaseInitialized: false,
          fetchCalls: 0,
        });
        expect(await readdir(temporaryWorkspace)).toEqual([]);
      } finally {
        await rm(temporaryWorkspace, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
