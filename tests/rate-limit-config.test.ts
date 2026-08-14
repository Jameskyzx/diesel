import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("rate-limit environment isolation", () => {
  it("forces the in-memory backend for the offline demo and Playwright", async () => {
    const [demoServer, playwrightConfig] = await Promise.all([
      readFile("scripts/demo/server.ts", "utf8"),
      readFile("playwright.config.ts", "utf8"),
    ]);

    expect(demoServer).toContain(
      'process.env.AI_CHAT_RATE_LIMIT_BACKEND = "memory"',
    );
    expect(playwrightConfig).toContain(
      'AI_CHAT_RATE_LIMIT_BACKEND: "memory"',
    );
  });
});
