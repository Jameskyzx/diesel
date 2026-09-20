import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

type ReadinessResponseContract = Readonly<{
  HEALTH_CLOCK_TOLERANCE_MS: number;
  READINESS_RESPONSE_CONTRACT_VERSION: string;
  validateReadinessResponseV1: (input: {
    bodyText: string;
    contractVersion: string;
    expectedVersion: string;
    rawHeaders: string;
    requestStartedAtMs: number;
    responseReceivedAtMs: number;
  }) => void;
}>;

const require = createRequire(import.meta.url);
const contract = require(
  "../scripts/deploy/readiness-response-contract.cjs",
) as ReadinessResponseContract;

const expectedVersion = "a".repeat(40);
const requestStartedAtMs = Date.parse("2026-09-05T00:00:10.000Z");
const responseReceivedAtMs = requestStartedAtMs + 1_000;
const validBody = {
  checks: {
    aiChatAdmission: "ok",
    aiChatRateLimit: "ok",
    database: "ok",
  },
  service: "global-diesel-regulations",
  status: "ok",
  timestamp: "2026-09-05T00:00:10.500Z",
  version: expectedVersion,
};
const validHeaders = [
  "HTTP/1.1 200 OK",
  "Cache-Control: private, no-store, max-age=0",
  "Pragma: no-cache",
  "X-Request-Id: fixture",
  "",
  "",
].join("\r\n");

function validate(overrides: Partial<Parameters<
  ReadinessResponseContract["validateReadinessResponseV1"]
>[0]> = {}): void {
  contract.validateReadinessResponseV1({
    bodyText: JSON.stringify(validBody),
    contractVersion: contract.READINESS_RESPONSE_CONTRACT_VERSION,
    expectedVersion,
    rawHeaders: validHeaders,
    requestStartedAtMs,
    responseReceivedAtMs,
    ...overrides,
  });
}

describe("versioned readiness response contract", () => {
  it("accepts only the named v1 contract and immutable clock tolerance", () => {
    expect(contract.READINESS_RESPONSE_CONTRACT_VERSION).toBe(
      "diesel-readiness-response-v1",
    );
    expect(contract.HEALTH_CLOCK_TOLERANCE_MS).toBe(5_000);
    expect(() => validate()).not.toThrow();
    expect(() => validate({ contractVersion: "other" })).toThrow(
      "Unexpected application readiness payload.",
    );
  });

  it.each([
    requestStartedAtMs - 5_000,
    responseReceivedAtMs + 5_000,
  ])("accepts the inclusive timestamp boundary %i", (timestampMs) => {
    expect(() =>
      validate({
        bodyText: JSON.stringify({
          ...validBody,
          timestamp: new Date(timestampMs).toISOString(),
        }),
      }),
    ).not.toThrow();
  });

  it.each([
    {
      body: { ...validBody, unexpected: true },
      label: "an extra top-level field",
    },
    {
      body: {
        ...validBody,
        checks: { ...validBody.checks, provider: "ok" },
      },
      label: "an extra check",
    },
    {
      body: { ...validBody, checks: { database: "ok" } },
      label: "a missing admission check",
    },
    {
      body: {
        ...validBody,
        checks: { aiChatAdmission: "ok", database: "ok" },
      },
      label: "a missing hourly rate-limit check",
    },
    {
      body: {
        ...validBody,
        checks: { ...validBody.checks, aiChatRateLimit: "unavailable" },
      },
      label: "an unavailable hourly rate-limit check",
    },
    {
      body: { ...validBody, timestamp: undefined },
      label: "a missing timestamp",
    },
    {
      body: {
        ...validBody,
        timestamp: new Date(requestStartedAtMs - 5_001).toISOString(),
      },
      label: "a stale timestamp",
    },
    {
      body: {
        ...validBody,
        timestamp: new Date(responseReceivedAtMs + 5_001).toISOString(),
      },
      label: "an overly future timestamp",
    },
    {
      body: { ...validBody, timestamp: "2026-09-05T00:00:10Z" },
      label: "a noncanonical timestamp",
    },
  ])("rejects $label", ({ body }) => {
    expect(() => validate({ bodyText: JSON.stringify(body) })).toThrow(
      "Unexpected application readiness payload.",
    );
  });

  it.each([
    {
      headers: validHeaders.replace(
        "private, no-store, max-age=0",
        "public, max-age=60",
      ),
      label: "a cacheable response",
    },
    {
      headers: validHeaders.replace("Pragma: no-cache\r\n", ""),
      label: "a missing pragma",
    },
    {
      headers: validHeaders.replace(
        "Pragma: no-cache\r\n",
        "Pragma: no-cache\r\nPragma: no-cache\r\n",
      ),
      label: "a duplicate pragma",
    },
    {
      headers: validHeaders.replace(
        "Cache-Control: private, no-store, max-age=0\r\n",
        [
          "Cache-Control: private, no-store, max-age=0",
          "Cache-Control: private, no-store, max-age=0",
          "",
        ].join("\r\n"),
      ),
      label: "a duplicate cache-control header",
    },
    {
      headers: validHeaders.replace("HTTP/1.1 200 OK", "HTTP/1.1 204 No Content"),
      label: "a non-200 status",
    },
  ])("rejects $label", ({ headers }) => {
    expect(() => validate({ rawHeaders: headers })).toThrow(
      "Unexpected application readiness payload.",
    );
  });
});
