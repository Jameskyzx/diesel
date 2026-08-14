import { describe, expect, it } from "vitest";

import {
  assertProductionMigrationLineage,
  assertProductionReadback,
  recognizedLegacyMigrationExtras,
  recognizedMigrationHashAliases,
} from "../scripts/db/production-readback";

const valid = {
  activeInvalidProducts: 0,
  apiRateLimitTableExists: true,
  expectedMigrationCount: 14,
  membershipExclusionDefinition:
    `EXCLUDE USING gist (("country_iso3") WITH =, "jurisdiction_id" WITH =,
      (daterange("valid_from", "valid_to", '[)'::text)) WITH &&)
      WHERE (("archived_at" IS NULL))`,
  migrationCount: 14,
  productPowerDefinition:
    `CHECK (("archived_at" IS NOT NULL) OR (("power_min_kw" >= 0) AND (("power_max_kw") > ("power_min_kw"))))`,
  rateLimitCountDefinition: `CHECK ((("request_count") > 0))`,
  recognizedLegacyMigrationCount: 0,
};

describe("production database readback", () => {
  it("accepts semantic constraints despite redundant formatting", () => {
    expect(() => assertProductionReadback(valid)).not.toThrow();
  });

  it.each([
    [{ ...valid, activeInvalidProducts: 1 }, /invalid products/],
    [{ ...valid, apiRateLimitTableExists: false }, /rate-limit table/],
    [{ ...valid, migrationCount: 13 }, /migration journal/],
    [{ ...valid, migrationCount: 15 }, /migration journal/],
    [{ ...valid, recognizedLegacyMigrationCount: 2 }, /migration journal/],
    [{ ...valid, productPowerDefinition: "CHECK (power_max_kw >= power_min_kw)" }, /not strict/],
    [{ ...valid, productPowerDefinition: "CHECK (power_max_kw > power_min_kw)" }, /not strict/],
    [{ ...valid, membershipExclusionDefinition: "PRIMARY KEY (country_iso3)" }, /exclusion/],
  ])("fails closed when a production invariant drifts", (input, error) => {
    expect(() => assertProductionReadback(input)).toThrow(error);
  });

  it("accepts the exact audited legacy migration in addition to repository migrations", () => {
    expect(() => assertProductionReadback({
      ...valid,
      migrationCount: 15,
      recognizedLegacyMigrationCount: 1,
    })).not.toThrow();
  });
});

describe("production migration lineage", () => {
  const expected = [
    { createdAt: "100", hash: "a".repeat(64) },
    { createdAt: "1786723485791", hash: "b".repeat(64) },
  ];

  it("accepts exact repository identities", () => {
    expect(assertProductionMigrationLineage({ actual: expected, expected }))
      .toEqual({
        recognizedLegacyHashAliases: 0,
        recognizedLegacyMigrationCount: 0,
      });
  });

  it("accepts only the audited orphan migration and old 0011 hash", () => {
    const legacyAlias = recognizedMigrationHashAliases[0];
    const legacyExtra = recognizedLegacyMigrationExtras[0];
    expect(assertProductionMigrationLineage({
      actual: [expected[0]!, legacyAlias, legacyExtra],
      expected,
    })).toEqual({
      recognizedLegacyHashAliases: 1,
      recognizedLegacyMigrationCount: 1,
    });
  });

  it.each([
    [[expected[0]!], /missing/],
    [[expected[0]!, { ...expected[1]!, hash: "c".repeat(64) }], /hash/],
    [[...expected, { createdAt: "200", hash: "d".repeat(64) }], /unknown extra/],
    [[...expected, expected[0]!], /duplicate/],
  ] as const)("fails closed for incomplete or unknown lineage", (actual, error) => {
    expect(() => assertProductionMigrationLineage({ actual, expected }))
      .toThrow(error);
  });
});
