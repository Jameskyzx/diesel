import { describe, expect, it, vi } from "vitest";

import {
  createCanaryChecks,
  runCanaryCheck,
  validateCanaryJson,
  validateCanaryBaseUrl,
} from "@/domain/operations/synthetic-canary";

describe("synthetic canary", () => {
  it("normalizes an HTTP target without preserving credentials or paths", () => {
    expect(validateCanaryBaseUrl("https://jamesky.site/deploy?secret=no").href)
      .toBe("https://jamesky.site/");
    expect(() => validateCanaryBaseUrl("https://user:pass@example.com"))
      .toThrow(/without credentials/);
    expect(() => validateCanaryBaseUrl("file:///tmp/report"))
      .toThrow(/HTTP\(S\)/);
  });

  it("keeps the paid AI check opt-in", () => {
    expect(createCanaryChecks({ asOf: "2026-08-15", includeAi: false }))
      .toHaveLength(4);
    expect(
      createCanaryChecks({ asOf: "2026-08-15", includeAi: true }).at(-1)?.id,
    ).toBe("ai-sse");
  });

  it("validates each expected public JSON shape", () => {
    const baseHealth = {
      service: "global-diesel-regulations",
      status: "ok",
      timestamp: "2026-08-15T00:00:00.000Z",
      version: "release-sha",
    };
    expect(validateCanaryJson("liveness", baseHealth)).toBe(true);
    expect(validateCanaryJson("readiness", {
      ...baseHealth,
      checks: { database: "ok" },
    })).toBe(true);
    expect(validateCanaryJson("readiness", {
      ...baseHealth,
      checks: { database: "unavailable" },
      status: "unavailable",
    })).toBe(false);
    expect(validateCanaryJson("liveness", { status: "live" })).toBe(false);
    expect(validateCanaryJson("country-summary", {
      applicabilitySummary: {},
      status: "available",
    })).toBe(true);
    expect(validateCanaryJson("products", { products: [], status: "ok" }))
      .toBe(true);
    expect(validateCanaryJson("products", null)).toBe(false);
  });

  it("returns only sanitized metadata for a passing check", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { products: [], status: "ok" },
        { headers: { "X-Request-Id": "request-1" } },
      ),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      includeAi: false,
    }).find(({ id }) => id === "public-products")!;

    const result = await runCanaryCheck({
      baseUrl: new URL("https://jamesky.site"),
      check,
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({
      errorCode: null,
      id: "public-products",
      pass: true,
      requestId: "request-1",
      status: 200,
    });
    expect(JSON.stringify(result)).not.toContain('"products":[]');
  });

  it("fails closed on an invalid successful response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: "ok" }),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      includeAi: false,
    }).find(({ id }) => id === "public-products")!;

    await expect(runCanaryCheck({
      baseUrl: new URL("https://jamesky.site"),
      check,
      fetchImpl,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      errorCode: "INVALID_RESPONSE",
      pass: false,
    });
  });

  it("reports network failures without response data", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("secret upstream failure"),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      includeAi: false,
    })[0]!;

    await expect(runCanaryCheck({
      baseUrl: new URL("https://jamesky.site"),
      check,
      fetchImpl,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      errorCode: "NETWORK_ERROR",
      pass: false,
      requestId: null,
      status: null,
    });
  });
});
