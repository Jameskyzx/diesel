import { defineConfig, devices } from "@playwright/test";

import { shouldForbidOnlyInPlaywrightRun } from "./scripts/portfolio/playwright-evidence";

const baseURL =
  process.env.PLAYWRIGHT_FDE_BASE_URL ?? "http://127.0.0.1:3300";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "fde-demo.spec.ts",
  globalTeardown: "./scripts/e2e/fde-global-teardown.ts",
  forbidOnly: shouldForbidOnlyInPlaywrightRun(),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    [
      "./scripts/portfolio/playwright-run-reporter.ts",
      { id: "fde" },
    ],
  ],
  outputDir: "test-results/fde",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_FDE_BASE_URL
    ? undefined
    : {
        command: "pnpm demo:fde",
        env: {
          DEMO_HOST: "127.0.0.1",
          DEMO_PORT: "3300",
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: `${baseURL}/api/health/ready`,
      },
  projects: [
    {
      name: "fde-demo-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "fde-demo-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
