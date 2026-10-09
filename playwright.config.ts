import { defineConfig, devices } from "@playwright/test";

import { shouldForbidOnlyInPlaywrightRun } from "./scripts/portfolio/playwright-evidence";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["demo.spec.ts", "fde-demo.spec.ts"],
  fullyParallel: true,
  forbidOnly: shouldForbidOnlyInPlaywrightRun(),
  globalTeardown: "./scripts/e2e/global-teardown.ts",
  retries: process.env.CI ? 2 : 0,
  // The full single-worker matrix exceeded 25 minutes on hosted Linux with no
  // failed assertions. Keep per-case limits unchanged and reserve ten minutes
  // in the 60-minute job for setup, production CSP and diagnostic uploads.
  globalTimeout: process.env.CI ? 50 * 60_000 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { open: "never" }],
        [
          "./scripts/portfolio/playwright-run-reporter.ts",
          { id: "public" },
        ],
      ]
    : [
        ["list"],
        [
          "./scripts/portfolio/playwright-run-reporter.ts",
          { id: "public" },
        ],
      ],
  outputDir: "test-results/public",
  timeout: process.env.CI ? 60_000 : 30_000,
  // Every project shares one Next development server. Concurrent on-demand
  // route compilation can broadcast a full HMR reload into another worker's
  // stateful form or chat flow, so correctness takes precedence over parallel
  // throughput here. Production CSP has its own build/start configuration.
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    ...(process.env.PLAYWRIGHT_BASE_URL
      ? []
      : [{
        // The single long-lived webpack dev server exceeded Node's default
        // ~4 GiB heap while compiling the final knowledge route in CI. Bound
        // only this test process at 6 GiB; production and other servers retain
        // their own limits. Public Linux runners provide 16 GB total RAM.
        command: "pnpm exec node --max-old-space-size=6144 --import tsx scripts/e2e/server.ts",
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
      }]),
    {
      command: "pnpm exec tsx scripts/e2e/global-error-server.ts",
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3200",
    },
  ],
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: [
        "demo.spec.ts",
        "fde-demo.spec.ts",
        "global-error-hydration.spec.ts",
        "knowledge.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testIgnore: [
        "demo.spec.ts",
        "fde-demo.spec.ts",
        "global-error-hydration.spec.ts",
        "knowledge.spec.ts",
      ],
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "core-webkit",
      testMatch: ["accessibility.spec.ts", "locale.spec.ts", "map-runtime.spec.ts"],
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "global-error-chromium",
      testMatch: "global-error-hydration.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:3200",
      },
    },
    {
      name: "knowledge-chromium",
      dependencies: [
        "desktop-chromium",
        "mobile-chromium",
        "core-webkit",
      ],
      fullyParallel: false,
      testMatch: "knowledge.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
