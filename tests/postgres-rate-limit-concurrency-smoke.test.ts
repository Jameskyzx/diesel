import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  composePostgresRateLimitSmokeError,
  postgresRateLimitConcurrencySmokeScenarioNames,
  validatePostgresRateLimitConcurrencySmokeTarget,
  validatePostgresRateLimitScenarioReadback,
  validatePostgresRateLimitSmokeSessionPids,
} from "../scripts/db/postgres-rate-limit-concurrency-smoke";

const optIn = {
  DIESEL_POSTGRES_CONCURRENCY_SMOKE: "1",
} as const;
const globalHash = createHash("sha256")
  .update("diesel:ai-chat-hourly-rate-limit:v1:global")
  .digest("hex");

function clientHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function createValidReadback() {
  return {
    clientKeys: ["client-a", "client-b", "client-c"],
    clientLimit: 1,
    clientScope: "ai-chat-hourly-pg-client-test",
    decisions: [
      {
        allowed: true,
        limit: 1,
        remaining: 0,
        retryAfterSeconds: 0,
      },
      {
        allowed: false,
        limit: 1,
        remaining: 0,
        retryAfterSeconds: 120,
      },
      {
        allowed: true,
        limit: 1,
        remaining: 0,
        retryAfterSeconds: 0,
      },
    ],
    expectedAllowed: 2,
    globalLimit: 2,
    globalScope: "ai-chat-hourly-pg-global-test",
    rows: [
      {
        keyHash: clientHash("client-a"),
        requestCount: 1,
        scope: "ai-chat-hourly-pg-client-test",
      },
      {
        keyHash: clientHash("client-c"),
        requestCount: 1,
        scope: "ai-chat-hourly-pg-client-test",
      },
      {
        keyHash: globalHash,
        requestCount: 2,
        scope: "ai-chat-hourly-pg-global-test",
      },
    ],
  } as const;
}

describe("PostgreSQL AI chat rate-limit concurrency smoke", () => {
  it("keeps both distributed rollback scenarios explicit", () => {
    expect(postgresRateLimitConcurrencySmokeScenarioNames).toEqual([
      "global exhaustion across distinct clients",
      "client exhaustion rolls back the global reservation",
    ]);
  });

  it("uses multiple independent pools and the production limiter factory", async () => {
    const source = await readFile(
      new URL(
        "../scripts/db/postgres-rate-limit-concurrency-smoke.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain("repositoryPoolCount = 4");
    expect(source).toContain("createPostgresRateLimiter({");
    expect(source).toContain("createRateLimitRepository(database)");
    expect(source).toContain("await Promise.allSettled(");
    expect(source).toContain("select pg_backend_pid()::int");
    expect(source).toContain("cleanupScheduler = { schedule() {} }");
    expect(source).toContain("await cleanupScopes(monitor, ownedScopes)");
  });

  it("requires a distinct live PostgreSQL session for every pool and the monitor", () => {
    expect(() =>
      validatePostgresRateLimitSmokeSessionPids([101, 102, 103, 104, 105]),
    ).not.toThrow();
    expect(() =>
      validatePostgresRateLimitSmokeSessionPids([101, 102, 103, 104]),
    ).toThrow();
    expect(() =>
      validatePostgresRateLimitSmokeSessionPids([101, 102, 103, 104, 104]),
    ).toThrow();
    expect(() =>
      validatePostgresRateLimitSmokeSessionPids([101, 102, 103, 104, 0]),
    ).toThrow();
  });

  it("runs inside the required PostgreSQL migration job", async () => {
    const [packageSource, workflowSource] = await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(
        new URL("../.github/workflows/ci.yml", import.meta.url),
        "utf8",
      ),
    ]);

    expect(packageSource).toContain(
      '"db:smoke:rate-limit-concurrency": "node --conditions=react-server --import tsx scripts/db/postgres-rate-limit-concurrency-smoke.ts"',
    );
    expect(workflowSource).toContain(
      "- name: Verify AI chat rate-limit PostgreSQL concurrency",
    );
    expect(workflowSource).toContain(
      "run: pnpm db:smoke:rate-limit-concurrency",
    );
  });

  it.each([
    "postgresql://postgres:postgres@127.0.0.1:5432/diesel_ci",
    "postgres://postgres:postgres@localhost:5432/diesel_ci",
    "postgresql://postgres:postgres@[::1]:5432/diesel_ci",
  ])("accepts only the opted-in dedicated loopback database: %s", (databaseUrl) => {
    expect(
      validatePostgresRateLimitConcurrencySmokeTarget({
        DATABASE_URL: databaseUrl,
        ...optIn,
      }),
    ).toBeInstanceOf(URL);
  });

  it.each([
    ["missing opt-in", {
      DATABASE_URL: "postgresql://postgres@127.0.0.1/diesel_ci",
    }],
    ["remote host", {
      DATABASE_URL: "postgresql://postgres@example.test/diesel_ci",
      ...optIn,
    }],
    ["wrong database", {
      DATABASE_URL: "postgresql://postgres@127.0.0.1/postgres",
      ...optIn,
    }],
    ["lookalike database", {
      DATABASE_URL: "postgresql://postgres@127.0.0.1/diesel_ci_backup",
      ...optIn,
    }],
  ])("rejects $0 before opening a connection", (_label, environment) => {
    expect(() =>
      validatePostgresRateLimitConcurrencySmokeTarget(environment),
    ).toThrow();
  });

  it("accepts an exact committed global/client readback", () => {
    expect(() =>
      validatePostgresRateLimitScenarioReadback(createValidReadback()),
    ).not.toThrow();
  });

  it("rejects count overflow, rejected-only client rows, and missing decisions", () => {
    const valid = createValidReadback();
    expect(() =>
      validatePostgresRateLimitScenarioReadback({
        ...valid,
        rows: valid.rows.map((row) =>
          row.scope === valid.globalScope
            ? { ...row, requestCount: 3 }
            : row,
        ),
      }),
    ).toThrow();
    expect(() =>
      validatePostgresRateLimitScenarioReadback({
        ...valid,
        rows: [
          ...valid.rows,
          {
            keyHash: clientHash("client-b"),
            requestCount: 1,
            scope: valid.clientScope,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validatePostgresRateLimitScenarioReadback({
        ...valid,
        decisions: valid.decisions.slice(1),
      }),
    ).toThrow();
  });

  it("preserves a primary error and every teardown failure", () => {
    const primaryError = new Error("primary");
    const composed = composePostgresRateLimitSmokeError({
      cleanupError: new Error("cleanup"),
      closeErrors: [new Error("close-one"), new Error("close-two")],
      primaryError,
    });

    expect(composed).toBeInstanceOf(AggregateError);
    expect((composed as AggregateError).errors).toHaveLength(4);
    expect((composed as AggregateError).cause).toBe(primaryError);
    expect(composePostgresRateLimitSmokeError({})).toBeNull();
  });
});
