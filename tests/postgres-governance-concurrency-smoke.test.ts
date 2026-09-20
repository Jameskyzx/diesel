import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { governanceMaintenanceTokenEnvironmentVariable } from "@/server/db/governance-maintenance-lock";
import {
  composePostgresConcurrencySmokeError,
  createSameMillisecondTimestampDrift,
  postgresGovernanceConcurrencySmokeScenarioNames,
  postgresConcurrencySmokeOptInEnvironmentVariable,
  postgresSourceVerifiedAtPrecisionCases,
  validatePostgresConcurrencyReadback,
  validatePostgresConcurrencySmokeTarget,
} from "../scripts/db/postgres-governance-concurrency-smoke";

const optIn = {
  [postgresConcurrencySmokeOptInEnvironmentVariable]: "1",
} as const;

describe("PostgreSQL governance concurrency smoke safety gate", () => {
  it("keeps all repository and HTTP barrier scenarios in the real PostgreSQL smoke", () => {
    expect(postgresGovernanceConcurrencySmokeScenarioNames).toEqual([
      "draft creation",
      "import confirmation",
      "source verified-at precision and insert race",
      "document reprocessing idempotent retry",
      "document reprocessing replay drift",
      "entity archive",
    ]);
  });

  it("runs both document barriers through the real admin reprocessing route", async () => {
    const [source, databaseClientSource] = await Promise.all([
      readFile(
        new URL(
          "../scripts/db/postgres-governance-concurrency-smoke.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/server/db/client.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(source).toContain(
      'import(\n      "../../src/app/api/admin/documents/[documentId]/reprocess/route"',
    );
    expect(source).toContain(
      "waitForDocumentDraftLockWaiters(\n        input.monitor,\n        input.abortSignal,\n        2,\n        input.routeApplicationName,",
    );
    expect(source).toContain(
      "set verified_at = ${driftedVerifiedAt}::timestamptz,\n            updated_at = ${driftedUpdatedAt}::timestamptz",
    );
    expect(source).toContain("and application_name = ${applicationName}");
    expect(source).toContain("assert.equal(driftedResponse.status, 409)");
    expect(databaseClientSource).toContain(
      "application_name: databaseApplicationName",
    );
    expect(databaseClientSource).toContain("randomUUID()");
  });

  it("locks the complete review draft chain in ascending version order before provenance validation", async () => {
    const repositorySource = await readFile(
      new URL(
        "../src/server/repositories/governance-repository.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const reviewStart = repositorySource.indexOf("async reviewDraft(input:");
    const reviewEnd = repositorySource.indexOf(
      "async updateSourceVerifiedAt(input:",
      reviewStart,
    );
    expect(reviewStart).toBeGreaterThanOrEqual(0);
    expect(reviewEnd).toBeGreaterThan(reviewStart);
    const reviewSource = repositorySource.slice(reviewStart, reviewEnd);
    const identityRead = reviewSource.indexOf(
      "const [draftIdentity] = await transaction",
    );
    const identityCheck = reviewSource.indexOf("if (!draftIdentity)");
    const ascendingChainLock = reviewSource.indexOf(
      '.orderBy(asc(dataGovernanceDrafts.version))\n          .for("update");',
    );
    const provenanceValidation = reviewSource.indexOf(
      "await requireCanonicalDocumentProvenance(transaction, draft)",
    );

    expect(identityRead).toBeGreaterThanOrEqual(0);
    expect(identityCheck).toBeGreaterThan(identityRead);
    expect(reviewSource.slice(identityRead, identityCheck)).not.toContain(
      '.for("update")',
    );
    expect(ascendingChainLock).toBeGreaterThan(identityCheck);
    expect(provenanceValidation).toBeGreaterThan(ascendingChainLock);
  });

  it("builds a distinct timestamp without crossing the millisecond boundary", () => {
    const original = "2026-09-05T12:34:56.123456Z";
    const drifted = createSameMillisecondTimestampDrift(original);

    expect(drifted).toBe("2026-09-05T12:34:56.123789Z");
    expect(drifted).not.toBe(original);
    expect(new Date(drifted).getTime()).toBe(new Date(original).getTime());
  });

  it("keeps the source race below PostgreSQL's millisecond boundary", () => {
    expect(postgresSourceVerifiedAtPrecisionCases).toEqual({
      current: "2026-03-01T00:00:00.123456Z",
      newer: "2026-03-01T00:00:00.123789Z",
      older: "2026-03-01T00:00:00.123000Z",
    });
    expect(
      new Date(postgresSourceVerifiedAtPrecisionCases.current).getTime(),
    ).toBe(new Date(postgresSourceVerifiedAtPrecisionCases.older).getTime());
    expect(
      new Date(postgresSourceVerifiedAtPrecisionCases.current).getTime(),
    ).toBe(new Date(postgresSourceVerifiedAtPrecisionCases.newer).getTime());
  });

  it.each([
    "postgresql://postgres:postgres@127.0.0.1:5432/diesel_ci",
    "postgres://postgres:postgres@localhost:5432/diesel_ci",
    "postgresql://postgres:postgres@[::1]:5432/diesel_ci",
  ])("accepts only the dedicated loopback CI target: %s", (databaseUrl) => {
    expect(
      validatePostgresConcurrencySmokeTarget({
        DATABASE_URL: databaseUrl,
        ...optIn,
      }),
    ).toBeInstanceOf(URL);
  });

  it.each([
    ["missing URL", optIn],
    [
      "wrong protocol",
      { DATABASE_URL: "https://127.0.0.1/diesel_ci", ...optIn },
    ],
    [
      "remote host",
      {
        DATABASE_URL: "postgresql://postgres@example.test/diesel_ci",
        ...optIn,
      },
    ],
    [
      "loopback lookalike",
      {
        DATABASE_URL: "postgresql://postgres@127.0.0.1.example/diesel_ci",
        ...optIn,
      },
    ],
    [
      "wrong database",
      {
        DATABASE_URL: "postgresql://postgres@127.0.0.1/postgres",
        ...optIn,
      },
    ],
    [
      "database suffix",
      {
        DATABASE_URL: "postgresql://postgres@127.0.0.1/diesel_ci_backup",
        ...optIn,
      },
    ],
    [
      "maintenance token",
      {
        DATABASE_URL: "postgresql://postgres@127.0.0.1/diesel_ci",
        ...optIn,
        [governanceMaintenanceTokenEnvironmentVariable]: "",
      },
    ],
  ])("rejects %s before opening a connection", (_label, environment) => {
    expect(() => validatePostgresConcurrencySmokeTarget(environment)).toThrow();
  });

  it.each([undefined, "", "0", "true"])(
    "rejects destructive opt-in value %s",
    (value) => {
      expect(() =>
        validatePostgresConcurrencySmokeTarget({
          DATABASE_URL: "postgresql://postgres@127.0.0.1/diesel_ci",
          [postgresConcurrencySmokeOptInEnvironmentVariable]: value,
        }),
      ).toThrow(/=1 is required/);
    },
  );

  it("accepts the expected connected PostgreSQL target", () => {
    expect(() =>
      validatePostgresConcurrencyReadback({
        currentDatabase: "diesel_ci",
        serverVersionNum: 160_009,
        vectorInstalled: true,
      }),
    ).not.toThrow();
  });

  it.each([
    ["wrong database", "other", 160_000, true],
    ["PostgreSQL 15", "diesel_ci", 150_000, true],
    ["PostgreSQL 17", "diesel_ci", 170_000, true],
    ["missing vector", "diesel_ci", 160_000, false],
  ])(
    "rejects connected readback with %s",
    (_label, currentDatabase, serverVersionNum, vectorInstalled) => {
      expect(() =>
        validatePostgresConcurrencyReadback({
          currentDatabase,
          serverVersionNum,
          vectorInstalled,
        }),
      ).toThrow();
    },
  );

  it("keeps the primary failure first when teardown also fails", () => {
    const primary = new Error("primary failure");
    const composed = composePostgresConcurrencySmokeError({
      cleanupError: new Error("cleanup failure"),
      monitorCloseError: new Error("monitor close failure"),
      operationalCloseError: new Error("operational close failure"),
      primaryError: primary,
    });

    expect(composed).toBeInstanceOf(AggregateError);
    const aggregate = composed as AggregateError;
    expect(aggregate.cause).toBe(primary);
    expect(aggregate.errors[0]).toBe(primary);
    expect(aggregate.message).toContain("primary failure");
    expect(aggregate.errors).toHaveLength(4);
  });

  it("reports teardown failures independently after a successful smoke", () => {
    const composed = composePostgresConcurrencySmokeError({
      cleanupError: new Error("cleanup failure"),
    });

    expect(composed).toBeInstanceOf(AggregateError);
    expect((composed as AggregateError).message).toContain("cleanup failure");
    expect(composePostgresConcurrencySmokeError({})).toBeNull();
  });
});
