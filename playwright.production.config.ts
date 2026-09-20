import { defineConfig, devices } from "@playwright/test";

import { shouldForbidOnlyInPlaywrightRun } from "./scripts/portfolio/playwright-evidence";

const baseURL =
  process.env.PLAYWRIGHT_PRODUCTION_BASE_URL ?? "http://127.0.0.1:3400";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "security-policy.spec.ts",
  forbidOnly: shouldForbidOnlyInPlaywrightRun(),
  reporter: [
    ["list"],
    [
      "./scripts/portfolio/playwright-run-reporter.ts",
      { id: "production-csp" },
    ],
  ],
  outputDir: "test-results/production-csp",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_PRODUCTION_BASE_URL
    ? undefined
    : {
        command:
          "pnpm start --hostname 127.0.0.1 --port 3400",
        env: {
          AI_API_KEY: "production-csp-placeholder-not-a-secret",
          AI_BASE_URL: "https://example.invalid/v1",
          AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY: "500",
          AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY: "50000",
          AI_CHAT_RATE_LIMIT_BACKEND: "postgres",
          AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: "300",
          AI_CHAT_RATE_LIMIT_PER_HOUR: "30",
          AI_MODEL: "production-csp-placeholder-model",
          AI_MULTIMODAL_MODEL: "production-csp-placeholder-vision-model",
          AI_PROVIDER: "openai-compatible",
          APP_VERSION: "production-csp-e2e",
          DATABASE_MODE: "postgres",
          DATABASE_URL:
            "postgresql://diesel_e2e:unused@127.0.0.1:1/diesel_e2e",
          KNOWLEDGE_STORAGE_ROOT: "production-csp-e2e-knowledge",
          NODE_ENV: "production",
          PORTFOLIO_DEMO_MODE: "false",
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: `${baseURL}/api/health/live`,
      },
  projects: [
    {
      name: "production-csp-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
