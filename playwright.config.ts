import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "demo.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  globalTeardown: "./scripts/e2e/global-teardown.ts",
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
  timeout: process.env.CI ? 60_000 : 30_000,
  workers: process.env.CI ? 2 : 4,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm exec tsx scripts/e2e/server.ts",
        env: {
          // E2E only checks configuration-aware UI and deterministic chat
          // responses. No test sends a request to this placeholder endpoint.
          AI_API_KEY: "e2e-placeholder-not-a-secret",
          AI_BASE_URL: "https://example.com/v1",
          AI_MODEL: "e2e-placeholder-model",
          AI_MULTIMODAL_MODEL: "e2e-placeholder-vision-model",
          AI_PROVIDER: "openai-compatible",
          AI_CHAT_RATE_LIMIT_BACKEND: "memory",
          DATABASE_MODE: "pglite-demo",
          KNOWLEDGE_STORAGE_ROOT: "e2e-knowledge",
          PLAYWRIGHT_E2E: "true",
          // 小阈值使 Demo fixture（2026-01-15 核验）在所有运行日期都判定
          // 为 stale，确定性覆盖 ADR-045 的 UI 告警。
          COUNTRY_STALE_AFTER_DAYS: "1",
          ADMIN_ROLE_BINDINGS_JSON:
            '{"editor@example.test":"editor","reviewer@example.test":"reviewer","admin@example.test":"admin"}',
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: `${baseURL}/api/health/ready`,
      },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "core-webkit",
      testMatch: ["accessibility.spec.ts", "locale.spec.ts"],
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
