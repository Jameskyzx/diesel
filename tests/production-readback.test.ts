import { describe, expect, it } from "vitest";

import { assertProductionReadback } from "../scripts/db/production-readback";

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
};

describe("production database readback", () => {
  it("accepts semantic constraints despite redundant formatting", () => {
    expect(() => assertProductionReadback(valid)).not.toThrow();
  });

  it.each([
    [{ ...valid, activeInvalidProducts: 1 }, /invalid products/],
    [{ ...valid, apiRateLimitTableExists: false }, /rate-limit table/],
    [{ ...valid, migrationCount: 13 }, /migration journal/],
    [{ ...valid, productPowerDefinition: "CHECK (power_max_kw >= power_min_kw)" }, /not strict/],
    [{ ...valid, productPowerDefinition: "CHECK (power_max_kw > power_min_kw)" }, /not strict/],
    [{ ...valid, membershipExclusionDefinition: "PRIMARY KEY (country_iso3)" }, /exclusion/],
  ])("fails closed when a production invariant drifts", (input, error) => {
    expect(() => assertProductionReadback(input)).toThrow(error);
  });
});
