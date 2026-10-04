import { defineConfig } from "@playwright/test";
import { z } from "zod";

// Explicit opt-in: this suite calls the deployed database, admission gates and
// paid model. It never starts a demo server or intercepts /api/chat.
z.literal("true").parse(process.env.DIESEL_LIVE_ACCEPTANCE);
z.string().regex(/^[0-9a-f]{40}$/u).parse(process.env.DIESEL_LIVE_RELEASE);
const outputDir = `test-results/live-${Date.now()}`;

export default defineConfig({
  testDir: "./e2e-live",
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  outputDir,
  reporter: [["list"], ["json", { outputFile: `${outputDir}/report.json` }]],
  use: {
    baseURL: "https://diesel.jamesky.site",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
});
