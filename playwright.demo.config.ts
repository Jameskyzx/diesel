import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_DEMO_BASE_URL ?? "http://127.0.0.1:3200";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "demo.spec.ts",
  globalTeardown: "./scripts/e2e/demo-global-teardown.ts",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-demo-report" }],
      ]
    : [
        ["list"],
      ],
  outputDir: "test-results/demo",
  timeout: process.env.CI ? 60_000 : 30_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_DEMO_BASE_URL
    ? undefined
    : {
        command: "pnpm demo",
        env: {
          // Desktop cases share one loopback client bucket. Give this
          // isolated offline workload explicit capacity, not production defaults.
          AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: "10000",
          AI_CHAT_RATE_LIMIT_PER_HOUR: "10000",
          DEMO_HOST: "127.0.0.1",
          DEMO_PORT: "3200",
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: `${baseURL}/api/health/ready`,
      },
  projects: [
    {
      name: "portfolio-demo-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
