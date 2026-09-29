import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  CANARY_HEALTH_CACHE_CONTROL,
  CANARY_HEALTH_MAX_CLOCK_SKEW_MS,
  CANARY_HEALTH_PRAGMA,
  createCanaryChecks,
  runCanaryCheck,
  validateCanaryJson,
  validateCanaryBaseUrl,
  validateUiMessageSse,
} from "@/domain/operations/synthetic-canary";

const execFileAsync = promisify(execFile);
const verifiedAt = "2026-08-15T00:00:00.000Z";
const healthRequestStartedAtMs = Date.parse(verifiedAt);
const healthResponseReceivedAtMs = healthRequestStartedAtMs + 1_000;
const healthTimeWindow = {
  maxClockSkewMs: CANARY_HEALTH_MAX_CLOCK_SKEW_MS,
  requestStartedAtMs: healthRequestStartedAtMs,
  responseReceivedAtMs: healthResponseReceivedAtMs,
};

function validateHealthJson(
  shape: "liveness" | "readiness",
  value: unknown,
  expectedVersion?: string,
): boolean {
  return validateCanaryJson(
    shape,
    value,
    undefined,
    expectedVersion,
    undefined,
    healthTimeWindow,
  );
}

function createCountryDecisionSummary(asOf = "2026-08-15") {
  const countrySource = {
    id: "00000000-0000-4000-8000-000000000001",
    isDemo: true,
    publishedOn: null,
    publisher: "Demo publisher",
    title: "Demo country source",
    url: null,
    verifiedAt,
  };
  const jurisdictionId = "00000000-0000-4000-8000-000000000002";
  const regulationId = "00000000-0000-4000-8000-000000000003";
  const limitId = "00000000-0000-4000-8000-000000000004";
  const jurisdictionName = "Demo jurisdiction";
  const regulationName = "Demo regulation";
  const analysisSource = (input: {
    entityId: string;
    entityType:
      | "country_jurisdiction"
      | "jurisdiction"
      | "regulation"
      | "regulation_limit";
    locator: string;
    locatorDescriptor?: Record<string, unknown>;
    title: string;
    titleDescriptor?: Record<string, unknown>;
  }) => ({
    countryIso3: "CHN",
    entityId: input.entityId,
    entityType: input.entityType,
    isDemo: true,
    locator: input.locator,
    ...(input.locatorDescriptor === undefined
      ? {}
      : { locatorDescriptor: input.locatorDescriptor }),
    publishedOn: null,
    regulationId,
    regulationStatus: "effective",
    sourceId: countrySource.id,
    sourceTitle: countrySource.title,
    sourceUrl: countrySource.url,
    title: input.title,
    ...(input.titleDescriptor === undefined
      ? {}
      : { titleDescriptor: input.titleDescriptor }),
    verifiedAt,
  });
  const jurisdictionSource = analysisSource({
    entityId: jurisdictionId,
    entityType: "jurisdiction",
    locator: "DEMO-J",
    title: jurisdictionName,
  });
  const membershipSource = analysisSource({
    entityId: jurisdictionId,
    entityType: "country_jurisdiction",
    locator: "2020-01-01–open",
    locatorDescriptor: {
      kind: "membership_period",
      validFrom: "2020-01-01",
      validTo: null,
    },
    title: `${jurisdictionName} 对 CHN 的成员关系`,
    titleDescriptor: {
      countryIso3: "CHN",
      jurisdictionName,
      kind: "country_jurisdiction_membership",
    },
  });
  const regulationSource = analysisSource({
    entityId: regulationId,
    entityType: "regulation",
    locator: "DEMO-R",
    title: regulationName,
  });
  const limitSource = analysisSource({
    entityId: limitId,
    entityType: "regulation_limit",
    locator: "NOX 2025-01-01–open",
    locatorDescriptor: {
      kind: "regulation_limit_period",
      pollutantCode: "NOX",
      validFrom: "2025-01-01",
      validTo: null,
    },
    title: `${regulationName} NOX 限值`,
    titleDescriptor: {
      kind: "regulation_pollutant_limit",
      pollutantCode: "NOX",
      regulationName,
    },
  });
  const profileApplicability = {
    countryIso3: "CHN",
    jurisdiction: {
      code: "DEMO-J",
      id: jurisdictionId,
      isDemo: true,
      name: jurisdictionName,
      source: countrySource,
      verifiedAt,
    },
    membership: {
      isDemo: true,
      source: countrySource,
      validFrom: "2020-01-01",
      validTo: null,
      verifiedAt,
    },
  };
  const summaryApplicability = {
    countryIso3: "CHN",
    jurisdiction: {
      code: "DEMO-J",
      id: jurisdictionId,
      isDemo: true,
      name: jurisdictionName,
      source: jurisdictionSource,
      verifiedAt,
    },
    membership: {
      isDemo: true,
      source: membershipSource,
      validFrom: "2020-01-01",
      validTo: null,
      verifiedAt,
    },
  };
  const profileRegulation = {
    adoptedOn: "2024-01-01",
    applicability: profileApplicability,
    canonicalName: regulationName,
    citationCode: "DEMO-R",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    id: regulationId,
    isDemo: true,
    proposedOn: null,
    source: countrySource,
    status: "effective",
    statusAtAsOf: "effective",
    verifiedAt,
  };
  const summaryRegulation = {
    applicability: summaryApplicability,
    canonicalName: regulationName,
    citationCode: "DEMO-R",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    id: regulationId,
    isDemo: true,
    limits: [
      {
        id: limitId,
        isDemo: true,
        limitValue: "1.000000",
        pollutantCode: "NOX",
        powerMaxKw: 200,
        powerMinKw: 0,
        source: limitSource,
        unitCode: "g/kWh",
        validFrom: "2025-01-01",
        validTo: null,
        verifiedAt,
      },
    ],
    recordStatus: "effective",
    source: regulationSource,
    status: "effective",
    verifiedAt,
  };

  return {
    applicabilitySummary: {
      country: {
        countryIsDemo: true,
        countryIso3: "CHN",
        countryName: "China",
        countrySource: {
          countryIso2: "CN",
          countryNameLocal: "中国",
          id: countrySource.id,
          isDemo: countrySource.isDemo,
          publishedOn: countrySource.publishedOn,
          title: countrySource.title,
          url: countrySource.url,
          verifiedAt: countrySource.verifiedAt,
        },
        currentEffectiveRegulations: [summaryRegulation],
        futureAdoptedRegulations: [],
        status: "available",
      },
      lastVerifiedAt: verifiedAt,
      missingData: [],
      query: {
        applicationScope: "non-road",
        asOf,
        countryIso3s: ["CHN"],
        powerKw: 100,
      },
      sources: [
        jurisdictionSource,
        membershipSource,
        regulationSource,
        limitSource,
      ],
    },
    asOf,
    country: {
      currentEffectiveRegulations: [profileRegulation],
      dataCoverageStatus: "demo",
      futureAdoptedRegulations: [],
      isDemo: true,
      iso2: "CN",
      iso3: "CHN",
      isStale: false,
      jurisdictions: [
        {
          code: "DEMO-J",
          id: jurisdictionId,
          isDemo: true,
          jurisdictionVerifiedAt: verifiedAt,
          membershipIsDemo: true,
          membershipSource: countrySource,
          name: jurisdictionName,
          source: countrySource,
          type: "country",
          validFrom: "2020-01-01",
          validTo: null,
          verifiedAt,
        },
      ],
      lastVerifiedAt: verifiedAt,
      marketMetrics: [],
      nameEn: "China",
      nameLocal: "中国",
      regionCode: "EAS",
      source: countrySource,
      sources: [countrySource],
      subregionCode: "EAS",
      verifiedAt,
    },
    status: "available",
  };
}

function validUiMessageSse(finishReason: string | null = "stop"): string {
  return [
    { type: "start" },
    { id: "answer", type: "text-start" },
    { delta: "Evidence-backed answer.", id: "answer", type: "text-delta" },
    { id: "answer", type: "text-end" },
    finishReason === null
      ? { type: "finish" }
      : { finishReason, type: "finish" },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("") + "data: [DONE]\n\n";
}

function createPublicDemoProducts() {
  return {
    products: ["DEMO-ENG-100", "DEMO-ENG-200"].map(
      (modelCode, index) => ({
        applicationScopes: ["non-road"],
        availableFrom: "2025-01-01",
        availableTo: "2030-01-01",
        id: `00000000-0000-4000-8000-00000000010${index}`,
        isDemo: true,
        modelCode,
        name: `Demo engine ${index + 1}`,
        powerMaxKw: 150,
        powerMinKw: 50,
        source: {
          id: `00000000-0000-4000-8000-00000000020${index}`,
          isDemo: true,
          publishedOn: "2026-01-01",
          title: "Demo product source",
          url: null,
          verifiedAt,
        },
        specificationVersion: "demo-v1",
        verifiedAt,
      }),
    ),
    status: "ok",
  };
}

describe("synthetic canary", () => {
  it("schedules the no-cost production checks and keeps paid AI manual", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), ".github/workflows/production-canary.yml"),
      "utf8",
    );

    expect(workflow).toContain('cron: "23 */6 * * *"');
    expect(workflow).toContain("CANARY_BASE_URL: https://diesel.jamesky.site");
    expect(workflow).toContain("inputs.include_ai");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("CANARY_STATUS_PATH: docs/STATUS.md");
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).not.toMatch(/CANARY_CHECK_AI:\s*true/u);
  });

  it("atomically persists a sanitized report when initialization fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diesel-canary-failure-"));
    const reportPath = join(directory, "canary.json");

    try {
      const result = await execFileAsync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          resolve(process.cwd(), "scripts/ops/synthetic-canary.ts"),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CANARY_BASE_URL: "https://user:super-secret@example.com/private",
            CANARY_CHECK_AI: "false",
            CANARY_REPORT_PATH: reportPath,
          },
        },
      ).catch((error: unknown) => error);
      expect(result).toMatchObject({ code: 1 });

      const serialized = await readFile(reportPath, "utf8");
      const report: unknown = JSON.parse(serialized);
      expect(report).toMatchObject({
        expectedVersion: null,
        includeProviderAi: false,
        pass: false,
        results: [],
        runError: {
          code: "INITIALIZATION_ERROR",
          stage: "base_url",
        },
        targetOrigin: null,
        version: "synthetic-canary-v3",
      });
      expect(serialized).not.toContain("super-secret");
      expect((await readdir(directory)).filter((name) => name.endsWith(".tmp")))
        .toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("normalizes an HTTP target without preserving credentials or paths", () => {
    expect(validateCanaryBaseUrl("https://jamesky.site/deploy?secret=no").href)
      .toBe("https://jamesky.site/");
    expect(() => validateCanaryBaseUrl("https://user:pass@example.com"))
      .toThrow(/without credentials/);
    expect(() => validateCanaryBaseUrl("file:///tmp/report"))
      .toThrow(/HTTP\(S\)/);
  });

  it("always checks deterministic chat SSE and keeps provider AI opt-in", () => {
    const expectedVersion = "a".repeat(40);
    const publicChecks = createCanaryChecks({
      asOf: "2026-08-15",
      expectedVersion,
      includeProviderAi: false,
    });
    const paidChecks = createCanaryChecks({
      asOf: "2026-08-15",
      includeProviderAi: true,
    });

    expect(publicChecks).toHaveLength(5);
    expect(publicChecks.every(({ requireRequestId }) => requireRequestId))
      .toBe(true);
    expect(publicChecks.slice(0, 2)).toEqual([
      expect.objectContaining({ expectedVersion, id: "liveness" }),
      expect.objectContaining({ expectedVersion, id: "readiness" }),
    ]);
    const directCheck = publicChecks.find(({ id }) => id === "chat-direct-sse");
    expect(directCheck).toMatchObject({
      requireRequestId: true,
      streamShape: "ui-message-v1",
    });
    expect(JSON.parse(directCheck?.body ?? "{}")).toMatchObject({
      locale: "en",
      messages: [
        expect.objectContaining({
          parts: [{ text: "What can you do?", type: "text" }],
        }),
      ],
    });
    const providerCheck = paidChecks.at(-1);
    expect(providerCheck).toMatchObject({
      id: "chat-provider-sse",
      requireRequestId: true,
      streamShape: "ui-message-v1",
    });
    expect(JSON.parse(providerCheck?.body ?? "{}")).toMatchObject({
      locale: "zh-CN",
      messages: [
        expect.objectContaining({
          parts: [
            expect.objectContaining({ text: expect.stringContaining("CHN") }),
          ],
        }),
      ],
    });
    expect(publicChecks.find(({ id }) => id === "public-products"))
      .toMatchObject({
        productExpectation: {
          demoModelCodes: ["DEMO-ENG-100", "DEMO-ENG-200"],
          realProductCount: 0,
        },
      });
  });

  it("validates each expected public JSON shape", () => {
    const baseHealth = {
      service: "global-diesel-regulations",
      status: "ok",
      timestamp: "2026-08-15T00:00:00.000Z",
      version: "release-sha",
    };
    expect(validateCanaryJson("liveness", baseHealth)).toBe(false);
    expect(validateHealthJson("liveness", baseHealth)).toBe(true);
    expect(validateHealthJson("liveness", {
      ...baseHealth,
      timestamp: new Date(
        healthRequestStartedAtMs - CANARY_HEALTH_MAX_CLOCK_SKEW_MS,
      ).toISOString(),
    })).toBe(true);
    expect(validateHealthJson("readiness", {
      ...baseHealth,
      checks: {
        aiChatAdmission: "ok",
        aiChatRateLimit: "ok",
        database: "ok",
      },
      timestamp: new Date(
        healthResponseReceivedAtMs + CANARY_HEALTH_MAX_CLOCK_SKEW_MS,
      ).toISOString(),
    })).toBe(true);
    const expectedVersion = "a".repeat(40);
    expect(validateHealthJson(
      "liveness",
      { ...baseHealth, version: expectedVersion },
      expectedVersion,
    )).toBe(true);
    expect(validateHealthJson(
      "liveness",
      { ...baseHealth, version: "unexpected-old-release" },
      expectedVersion,
    )).toBe(false);
    expect(validateHealthJson("readiness", {
      ...baseHealth,
      checks: {
        aiChatAdmission: "ok",
        aiChatRateLimit: "ok",
        database: "ok",
      },
    })).toBe(true);
    expect(validateHealthJson(
      "readiness",
      {
        ...baseHealth,
        checks: {
          aiChatAdmission: "ok",
          aiChatRateLimit: "ok",
          database: "ok",
        },
        version: "unexpected-old-release",
      },
      expectedVersion,
    )).toBe(false);
    expect(validateHealthJson("readiness", {
      ...baseHealth,
      checks: {
        aiChatAdmission: "ok",
        aiChatRateLimit: "ok",
        database: "unavailable",
      },
      status: "unavailable",
    })).toBe(false);
    expect(validateHealthJson("readiness", {
      ...baseHealth,
      checks: {
        aiChatAdmission: "unavailable",
        aiChatRateLimit: "ok",
        database: "ok",
      },
      status: "unavailable",
    })).toBe(false);
    expect(validateHealthJson("liveness", { status: "live" })).toBe(false);
    const expectation = {
      applicationScope: "non-road" as const,
      asOf: "2026-08-15",
      countryIso3: "CHN",
      powerKw: 100,
    };
    expect(validateCanaryJson(
      "country-summary",
      createCountryDecisionSummary(),
      expectation,
    )).toBe(true);
    expect(validateCanaryJson(
      "country-summary",
      createCountryDecisionSummary("2026-08-14"),
      expectation,
    )).toBe(false);
    const staleSummary = createCountryDecisionSummary();
    expect(validateCanaryJson(
      "country-summary",
      {
        ...staleSummary,
        country: { ...staleSummary.country, isStale: true },
      },
      expectation,
    )).toBe(false);
    expect(validateCanaryJson("country-summary", {
      applicabilitySummary: {},
      status: "available",
    })).toBe(false);
    expect(validateCanaryJson("products", { products: [], status: "ok" }))
      .toBe(true);
    const productExpectation = {
      demoModelCodes: ["DEMO-ENG-100", "DEMO-ENG-200"],
      realProductCount: 0,
    };
    expect(validateCanaryJson(
      "products",
      createPublicDemoProducts(),
      undefined,
      undefined,
      productExpectation,
    )).toBe(true);
    expect(validateCanaryJson(
      "products",
      {
        ...createPublicDemoProducts(),
        products: createPublicDemoProducts().products.map((product, index) =>
          index === 0 ? { ...product, isDemo: false } : product,
        ),
      },
      undefined,
      undefined,
      productExpectation,
    )).toBe(false);
    expect(validateCanaryJson(
      "products",
      { products: [], status: "ok" },
      undefined,
      undefined,
      productExpectation,
    )).toBe(false);
    expect(validateCanaryJson("products", {
      products: [{}],
      status: "ok",
    })).toBe(false);
    expect(validateCanaryJson("products", null)).toBe(false);
  });

  it("accepts a fresh health response with the public no-store policy", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          service: "global-diesel-regulations",
          status: "ok",
          timestamp: verifiedAt,
          version: "a".repeat(40),
        },
        {
          headers: {
            "Cache-Control": CANARY_HEALTH_CACHE_CONTROL,
            Pragma: CANARY_HEALTH_PRAGMA,
            "X-Request-Id": "request-1",
          },
        },
      ),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      expectedVersion: "a".repeat(40),
      includeProviderAi: false,
    }).find(({ id }) => id === "liveness")!;
    const timestamps = [healthRequestStartedAtMs, healthResponseReceivedAtMs];

    await expect(runCanaryCheck({
      baseUrl: new URL("https://jamesky.site"),
      check,
      fetchImpl,
      now: () => timestamps.shift() ?? healthResponseReceivedAtMs,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      errorCode: null,
      pass: true,
    });
  });

  it.each([
    {
      label: "stale timestamp",
      omittedHeader: null,
      shape: "liveness" as const,
      timestamp: new Date(
        healthRequestStartedAtMs - CANARY_HEALTH_MAX_CLOCK_SKEW_MS - 1,
      ).toISOString(),
    },
    {
      label: "overly future timestamp",
      omittedHeader: null,
      shape: "readiness" as const,
      timestamp: new Date(
        healthResponseReceivedAtMs + CANARY_HEALTH_MAX_CLOCK_SKEW_MS + 1,
      ).toISOString(),
    },
    {
      label: "missing Cache-Control",
      omittedHeader: "cache-control",
      shape: "liveness" as const,
      timestamp: verifiedAt,
    },
    {
      label: "missing Pragma",
      omittedHeader: "pragma",
      shape: "readiness" as const,
      timestamp: verifiedAt,
    },
  ])(
    "fails closed for $shape health with $label",
    async ({ omittedHeader, shape, timestamp }) => {
      const headers = new Headers({
        "Cache-Control": CANARY_HEALTH_CACHE_CONTROL,
        Pragma: CANARY_HEALTH_PRAGMA,
        "X-Request-Id": "request-1",
      });
      if (omittedHeader !== null) {
        headers.delete(omittedHeader);
      }
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            ...(shape === "readiness"
              ? {
                  checks: {
                    aiChatAdmission: "ok",
                    aiChatRateLimit: "ok",
                    database: "ok",
                  },
                }
              : {}),
            service: "global-diesel-regulations",
            status: "ok",
            timestamp,
            version: "a".repeat(40),
          },
          { headers },
        ),
      );
      const check = createCanaryChecks({
        asOf: "2026-08-15",
        expectedVersion: "a".repeat(40),
        includeProviderAi: false,
      }).find(({ id }) => id === shape)!;
      const timestamps = [healthRequestStartedAtMs, healthResponseReceivedAtMs];

      await expect(runCanaryCheck({
        baseUrl: new URL("https://jamesky.site"),
        check,
        fetchImpl,
        now: () => timestamps.shift() ?? healthResponseReceivedAtMs,
        timeoutMs: 1_000,
      })).resolves.toMatchObject({
        errorCode: "INVALID_RESPONSE",
        pass: false,
      });
    },
  );

  it("requires a complete, non-reasoning UI message stream", async () => {
    await expect(validateUiMessageSse(validUiMessageSse())).resolves.toBe(true);

    for (const invalidStream of [
      "",
      'data: {"type":"error"}\n\ndata: [DONE]\n\n',
      'data: {"type":"reasoning-delta","delta":"private"}\n\n',
      validUiMessageSse().replace(
        'data: {"type":"start"}\n\n',
        'data: {"type":"start"}\n\ndata: {"type":"totally-invalid"}\n\n',
      ),
      'data: {"id":"answer","type":"text-start"}\n\ndata: {"type":"start"}\n\n',
      validUiMessageSse().replace("data: [DONE]\n\n", ""),
      `${validUiMessageSse()}data: [DONE]\n\n`,
      `${validUiMessageSse()}data: {"type":"finish"}\n\n`,
      [
        'data: {"type":"start"}\n\n',
        'data: {"id":"answer","type":"text-start"}\n\n',
        'data: {"delta":"unfinished","id":"answer","type":"text-delta"}\n\n',
        'data: {"type":"finish"}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    ]) {
      await expect(validateUiMessageSse(invalidStream)).resolves.toBe(false);
    }
  });

  it.each([
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
    null,
  ])("rejects the non-success finish reason %s", async (finishReason) => {
    await expect(validateUiMessageSse(validUiMessageSse(finishReason)))
      .resolves.toBe(false);
  });

  it("returns only sanitized metadata for a passing check", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        createPublicDemoProducts(),
        { headers: { "X-Request-Id": "request-1" } },
      ),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      includeProviderAi: false,
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
      Response.json(
        { status: "ok" },
        { headers: { "X-Request-Id": "request-1" } },
      ),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      includeProviderAi: false,
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

  it("fails closed when an otherwise valid response lacks a request ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ products: [], status: "ok" }),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      includeProviderAi: false,
    }).find(({ id }) => id === "public-products")!;

    await expect(runCanaryCheck({
      baseUrl: new URL("https://jamesky.site"),
      check,
      fetchImpl,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      errorCode: "MISSING_REQUEST_ID",
      pass: false,
    });
  });

  it("reads the AI body and rejects a terminal error stream", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('data: {"type":"error"}\n\ndata: [DONE]\n\n', {
        headers: {
          "Content-Type": "text/event-stream",
          "X-Request-Id": "request-1",
          "X-Vercel-AI-UI-Message-Stream": "v1",
        },
      }),
    );
    const check = createCanaryChecks({
      asOf: "2026-08-15",
      includeProviderAi: true,
    }).find(({ id }) => id === "chat-provider-sse")!;

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
      includeProviderAi: false,
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
