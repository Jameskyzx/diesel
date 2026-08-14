import { describe, expect, it } from "vitest";

import demoConfig from "../playwright.demo.config";
import e2eConfig from "../playwright.config";

function firstWebServer(
  configuration: typeof e2eConfig | typeof demoConfig,
) {
  const value = configuration.webServer;
  return Array.isArray(value) ? value[0] : value;
}

describe("Playwright server contracts", () => {
  it("forces the in-memory limiter with the PGlite E2E database", () => {
    expect(firstWebServer(e2eConfig)?.env).toMatchObject({
      AI_CHAT_RATE_LIMIT_BACKEND: "memory",
      DATABASE_MODE: "pglite-demo",
    });
  });

  it("runs the formal demo entry for desktop and mobile without a conditional skip", () => {
    expect(firstWebServer(demoConfig)?.command).toBe("pnpm demo");
    expect(demoConfig.projects?.map(({ name }) => name)).toEqual([
      "portfolio-demo-chromium",
      "portfolio-demo-mobile-chromium",
    ]);
  });
});
